# 第三方组件声明

本包只包含以下开源编码器的可执行文件，easytiny-mcp 以独立进程方式调用它们。各组件的许可证全文见 `licenses/` 目录，对应版本的完整源代码可从下表链接获取。

| 可执行文件 | 项目与版本 | 许可证 | 源代码 |
|---|---|---|---|
| `pngquant` | pngquant 3.0.3（含 libimagequant 4.x） | GPL-3.0-or-later | https://github.com/kornelski/pngquant/tree/3.0.3 |
| `gifsicle` | gifsicle 1.96 | GPL-2.0-only | https://www.lcdf.org/gifsicle/gifsicle-1.96.tar.gz |
| `oxipng` | oxipng 10.2.1 | MIT | https://github.com/oxipng/oxipng/tree/v10.2.1 |
| `ssimulacra2_rs` | ssimulacra2_rs 0.5.2 | BSD-2-Clause | https://crates.io/crates/ssimulacra2_rs/0.5.2 |
| `cwebp` | libwebp 1.6.0 | BSD-3-Clause | https://chromium.googlesource.com/webm/libwebp/+/refs/tags/v1.6.0 |
| `jpegtran` | mozjpeg 4.1.5 | IJG、BSD-3-Clause、Zlib | https://github.com/mozilla/mozjpeg/tree/v4.1.5 |
| `cjpegli` | jpegli 031a0077（静态链接 highway、skcms、libpng、zlib、lcms、libjpeg-turbo） | BSD-3-Clause 及各依赖许可证 | https://github.com/google/jpegli/tree/031a0077f5799a6041004267fc12b956c1f52a20 |
| `avifenc` | libavif 1.4.2 + libaom 3.14.1 | BSD-2-Clause（libaom 另附专利许可） | https://github.com/AOMediaCodec/libavif/tree/v1.4.2 、https://aomedia.googlesource.com/aom/+/refs/tags/v3.14.1 |

构建方式见 easytiny-mcp 仓库中的 `scripts/build-bins.sh`。
