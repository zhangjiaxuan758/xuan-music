#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkgbuild="${script_dir}/PKGBUILD"
srcinfo="${script_dir}/.SRCINFO"
desktop_file="${script_dir}/xuan-music-android.desktop"
icon_file="${script_dir}/xuan-music-android.png"

if [[ $# -ge 1 ]]; then
  version="$1"
else
  version="$(node -p "require('${script_dir}/../../../package.json').version")"
fi

desktop_sha256="$(sha256sum "${desktop_file}" | awk '{print $1}')"
icon_sha256="$(sha256sum "${icon_file}" | awk '{print $1}')"

sed -i -E "s/^pkgver=.*/pkgver=${version}/" "${pkgbuild}"
sed -i -E "0,/^[[:space:]]*'[0-9a-f]{64}'$/{s//  '${desktop_sha256}'/}" "${pkgbuild}"
sed -i -E "0,/^[[:space:]]*'[0-9a-f]{64}'$/{/^[[:space:]]*'${desktop_sha256}'$/!s//  '${icon_sha256}'/}" "${pkgbuild}"

cat > "${srcinfo}" <<EOF
pkgbase = xuan-music-android-bin
	pkgdesc = Lyrics Reimagine desktop app packaged from prebuilt releases
	pkgver = ${version}
	pkgrel = 1
	url = https://github.com/xuan-music-android
	arch = x86_64
	license = AGPL
	depends = alsa-lib
	depends = gtk3
	depends = libxss
	depends = nss
	optdepends = xdg-utils: desktop integration helpers
	provides = xuan-music-android
	conflicts = xuan-music-android
	source = https://github.com/xuan-music-android/releases/download/v${version}/xuan-music-android-${version}-linux-x64.tar.gz
	source = xuan-music-android.desktop
	source = xuan-music-android.png
	sha256sums = SKIP
	sha256sums = ${desktop_sha256}
	sha256sums = ${icon_sha256}

pkgname = xuan-music-android-bin
EOF

echo "Updated AUR files for version ${version}"
