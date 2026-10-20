#!/usr/bin/env bash
# 编译/下载编码器到 vendor/bin（macOS arm64 实测；Linux 需替换 libwebp 预编译包）
# 本机 SDK 有问题时先设置 SDKROOT，例如：SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=$ROOT/vendor/bin
WORK=${WORK:-/tmp/easytiny-build}
JOBS=$(getconf _NPROCESSORS_ONLN)
CMAKE_COMMON=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0)
[[ -n ${SDKROOT:-} ]] && CMAKE_COMMON+=(-DCMAKE_OSX_SYSROOT="$SDKROOT")
mkdir -p "$BIN" "$WORK"
cd "$WORK"

retry() { for i in 1 2 3 4 5; do "$@" && return; sleep 3; done; return 1; }
clone() { [[ -d $2 ]] || retry git clone --depth 1 ${3:+--branch $3} "$1" "$2"; }

# pngquant 3.0.3、oxipng 10.2.1、ssimulacra2_rs 0.5.2
retry cargo install --root "$ROOT/vendor" pngquant oxipng
retry cargo install --root "$ROOT/vendor" ssimulacra2_rs --no-default-features

# cwebp 1.6.0：官方预编译包
WEBP=libwebp-1.6.0-mac-arm64
[[ -d $WEBP ]] || { retry curl -fsSLO "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/$WEBP.tar.gz"; tar xzf "$WEBP.tar.gz"; }
cp "$WEBP/bin/cwebp" "$BIN/"

# gifsicle 1.96
[[ -d gifsicle-1.96 ]] || { retry curl -fsSLO https://www.lcdf.org/gifsicle/gifsicle-1.96.tar.gz; tar xzf gifsicle-1.96.tar.gz; }
(cd gifsicle-1.96 && ./configure --disable-gifview && make -j"$JOBS" && cp src/gifsicle "$BIN/")

# jpegtran（mozjpeg v4.1.5）
clone https://github.com/mozilla/mozjpeg mozjpeg v4.1.5
cmake -S mozjpeg -B mozjpeg/build "${CMAKE_COMMON[@]}" -DENABLE_SHARED=FALSE -DPNG_SUPPORTED=FALSE -DWITH_TURBOJPEG=FALSE
cmake --build mozjpeg/build -j"$JOBS" --target jpegtran-static
cp mozjpeg/build/jpegtran-static "$BIN/jpegtran"

# cjpegli（google/jpegli，需子模块）
clone https://github.com/google/jpegli jpegli
for m in third_party/highway third_party/skcms third_party/libpng third_party/zlib third_party/lcms third_party/libjpeg-turbo; do
  retry git -C jpegli submodule update --init --depth 1 "$m"
done
cmake -S jpegli -B jpegli/build "${CMAKE_COMMON[@]}" -DCMAKE_IGNORE_PREFIX_PATH="/usr/local;/opt/homebrew" \
  -DBUILD_TESTING=OFF -DJPEGLI_STATIC=ON -DJPEGLI_BUNDLE_LIBPNG=ON \
  -DJPEGLI_ENABLE_{BENCHMARK,DOXYGEN,MANPAGES,JNI,SJPEG,OPENEXR,TCMALLOC,FUZZERS,DEVTOOLS}=OFF
cmake --build jpegli/build -j"$JOBS" --target cjpegli
cp jpegli/build/tools/cjpegli "$BIN/"

# avifenc（libavif v1.4.2 + libaom v3.14.1，tune=iq 需要 libaom ≥ 3.12）
clone https://github.com/AOMediaCodec/libavif libavif v1.4.2
clone https://aomedia.googlesource.com/aom libavif/ext/aom v3.14.1
cmake -S libavif -B libavif/build "${CMAKE_COMMON[@]}" -DAVIF_CODEC_AOM=LOCAL -DAVIF_CODEC_AOM_DECODE=OFF \
  -DAVIF_LIBYUV=LOCAL -DAVIF_JPEG=LOCAL -DAVIF_LIBSHARPYUV=LOCAL -DAVIF_ZLIBPNG=LOCAL -DAVIF_BUILD_APPS=ON \
  -DFETCHCONTENT_SOURCE_DIR_LIBAOM="$WORK/libavif/ext/aom"
retry cmake --build libavif/build -j"$JOBS" --target avifenc
cp libavif/build/avifenc "$BIN/"

ls -l "$BIN"
