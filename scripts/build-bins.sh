#!/usr/bin/env bash
# 编译编码器到 <输出目录>/bin，许可证收集到 <输出目录>/licenses
# 用法：scripts/build-bins.sh [all|cargo|native] [输出目录，默认 vendor]
# 支持 macOS arm64/x64 与 Windows x64（native 部分需在 MSYS2 UCRT64 中运行）
# 本机 SDK 有问题时先设置 SDKROOT，例如：SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
set -euo pipefail
PART=${1:-all}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mkdir -p "${2:-$ROOT/vendor}" && cd "${2:-$ROOT/vendor}" && pwd)
BIN=$OUT/bin LIC=$OUT/licenses
WORK=${WORK:-${RUNNER_TEMP:-/tmp}/easytiny-build}
JOBS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
mkdir -p "$BIN" "$LIC" "$WORK"
cd "$WORK"

case $(uname -s) in Darwin) OS=mac ;; MINGW* | MSYS*) OS=win ;; *) echo "不支持的系统" >&2 && exit 1 ;; esac
case $(uname -m) in arm64 | aarch64) ARCH=arm64 ;; *) ARCH=x86-64 ;; esac
EXE=$([[ $OS == win ]] && echo .exe || true)

# 版本固定，升级时同步修改 npm/THIRD_PARTY_NOTICES.md
PNGQUANT=3.0.3 OXIPNG=10.2.1 SSIMULACRA2=0.5.2 WEBP=1.6.0 GIFSICLE=1.96
MOZJPEG=v4.1.5 JPEGLI=031a0077f5799a6041004267fc12b956c1f52a20 LIBAVIF=v1.4.2 AOM=v3.14.1

retry() { for _ in 1 2 3 4 5; do "$@" && return; sleep 5; done; return 1; }
# 浅克隆指定 tag 或 commit
clone() {
  [[ -d $2/.git ]] && return
  git init -q "$2" && git -C "$2" remote add origin "$1"
  retry git -C "$2" fetch -q --depth 1 origin "$3" && git -C "$2" checkout -q FETCH_HEAD
}
lic() { local name=$1 && shift && for f in "$@"; do [[ -f $f ]] && cp "$f" "$LIC/$name-$(basename "$f")"; done; true; }

if [[ $PART != native ]]; then
  # Windows 静态链接 C 运行时，避免依赖 vcruntime
  [[ $OS == win ]] && export RUSTFLAGS="-C target-feature=+crt-static"
  [[ $OS == mac ]] && export MACOSX_DEPLOYMENT_TARGET=12.0
  # static：不链接 CI 机器上 Homebrew 的 lcms2/libpng，否则用户机器上无法运行
  # 不加 --locked：锁定的旧版 libpng-sys 在新版 macOS SDK 上编译失败
  retry cargo install --root "$OUT" "pngquant@$PNGQUANT" --features static
  retry cargo install --locked --root "$OUT" "oxipng@$OXIPNG"
  retry cargo install --locked --root "$OUT" "ssimulacra2_rs@$SSIMULACRA2" --no-default-features
  rm -f "$OUT/.crates.toml" "$OUT/.crates2.json"
  CH=${CARGO_HOME:-$HOME/.cargo}
  [[ $OS == win ]] && CH=$(cygpath -u "$CH")
  REG=$(ls -d "$CH"/registry/src/*/ | head -1)
  lic pngquant "$REG"/pngquant-$PNGQUANT/COPYRIGHT
  lic oxipng "$REG"/oxipng-$OXIPNG/LICENSE
  lic ssimulacra2 "$REG"/ssimulacra2_rs-$SSIMULACRA2/LICENSE
fi
[[ $PART == cargo ]] && exit 0

CMAKE=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
if [[ $OS == mac ]]; then
  export MACOSX_DEPLOYMENT_TARGET=12.0
  CMAKE+=(-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0)
  [[ -n ${SDKROOT:-} ]] && CMAKE+=(-DCMAKE_OSX_SYSROOT="$SDKROOT")
else
  # MinGW 全静态链接，产物不依赖 libstdc++/winpthread 等 DLL
  export LDFLAGS=-static
  CMAKE+=(-G Ninja -DCMAKE_EXE_LINKER_FLAGS=-static)
fi

# cwebp：官方预编译包
W=libwebp-$WEBP-$([[ $OS == win ]] && echo windows-x64 || echo mac-$ARCH)
if [[ ! -d $W ]]; then
  if [[ $OS == win ]]; then retry curl -fsSLO "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/$W.zip" && unzip -q "$W.zip"
  else retry curl -fsSLO "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/$W.tar.gz" && tar xzf "$W.tar.gz"; fi
fi
cp "$W/bin/cwebp$EXE" "$BIN/"
lic libwebp "$W/COPYING" "$W/PATENTS"

# gifsicle
[[ -d gifsicle-$GIFSICLE ]] || { retry curl -fsSLO "https://www.lcdf.org/gifsicle/gifsicle-$GIFSICLE.tar.gz" && tar xzf "gifsicle-$GIFSICLE.tar.gz"; }
(cd "gifsicle-$GIFSICLE" && ./configure -q --disable-gifview --disable-gifdiff && make -j"$JOBS" && cp "src/gifsicle$EXE" "$BIN/")
lic gifsicle "gifsicle-$GIFSICLE/COPYING"

# jpegtran（mozjpeg）
clone https://github.com/mozilla/mozjpeg mozjpeg $MOZJPEG
cmake -S mozjpeg -B mozjpeg/build "${CMAKE[@]}" -DENABLE_SHARED=FALSE -DPNG_SUPPORTED=FALSE -DWITH_TURBOJPEG=FALSE
cmake --build mozjpeg/build -j"$JOBS" --target jpegtran-static
cp "mozjpeg/build/jpegtran-static$EXE" "$BIN/jpegtran$EXE"
lic mozjpeg mozjpeg/LICENSE.md mozjpeg/README.ijg

# cjpegli（google/jpegli，依赖子模块）
clone https://github.com/google/jpegli jpegli $JPEGLI
SUBS=(highway skcms libpng zlib lcms libjpeg-turbo)
for m in "${SUBS[@]}"; do retry git -C jpegli submodule update -q --init --depth 1 "third_party/$m"; done
cmake -S jpegli -B jpegli/build "${CMAKE[@]}" -DCMAKE_IGNORE_PREFIX_PATH="/usr/local;/opt/homebrew" \
  -DBUILD_TESTING=OFF -DJPEGLI_STATIC=ON -DJPEGLI_BUNDLE_LIBPNG=ON \
  -DJPEGLI_ENABLE_{BENCHMARK,DOXYGEN,MANPAGES,JNI,SJPEG,OPENEXR,TCMALLOC,FUZZERS,DEVTOOLS}=OFF
cmake --build jpegli/build -j"$JOBS" --target cjpegli
cp "jpegli/build/tools/cjpegli$EXE" "$BIN/"
lic jpegli jpegli/LICENSE
for m in "${SUBS[@]}"; do lic "jpegli-$m" jpegli/third_party/$m/LICENSE jpegli/third_party/$m/LICENSE.md; done

# avifenc（libavif + libaom，tune=iq 需要 libaom ≥ 3.12）
clone https://github.com/AOMediaCodec/libavif libavif $LIBAVIF
clone https://aomedia.googlesource.com/aom libavif/ext/aom $AOM
cmake -S libavif -B libavif/build "${CMAKE[@]}" -DAVIF_CODEC_AOM=LOCAL -DAVIF_CODEC_AOM_DECODE=OFF \
  -DAVIF_LIBYUV=LOCAL -DAVIF_JPEG=LOCAL -DAVIF_LIBSHARPYUV=LOCAL -DAVIF_ZLIBPNG=LOCAL -DAVIF_BUILD_APPS=ON \
  -DFETCHCONTENT_SOURCE_DIR_LIBAOM="$WORK/libavif/ext/aom"
retry cmake --build libavif/build -j"$JOBS" --target avifenc
cp "libavif/build/avifenc$EXE" "$BIN/"
lic libavif libavif/LICENSE
lic aom libavif/ext/aom/LICENSE libavif/ext/aom/PATENTS

# 只允许依赖系统库，避免在用户机器上缺库
if [[ $OS == mac ]]; then
  for f in "$BIN"/*; do
    bad=$(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/)' || true)
    [[ -z $bad ]] || { echo "$f 依赖非系统库：$bad" >&2; exit 1; }
  done
fi
ls -l "$BIN"
