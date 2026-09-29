#!/bin/sh
# Writes this directory's PNGs from the two layers of OpenReader.icon (#83).
#
# OpenReader.icon is the icon's one source. iOS is given it whole; Android and
# the top-level `icon` are given PNGs, and those are exported from its layers
# here rather than drawn a second time, so a colour or a shape is changed in
# Assets/headphones.svg or Assets/wave.svg and nowhere else. The one exception
# is the light background, which lives in icon.json as a fill rather than in
# an SVG, and is repeated below as BG_TOP and BG_BOTTOM.
#
# Needs rsvg-convert (`brew install librsvg`). Run it after changing a layer,
# then prebuild again; nothing runs it for you.
#
#   sh assets/icon/export-android.sh
#
# The wrappers are written into this directory and deleted afterwards because
# librsvg loads an <image> only from the referring file's directory or below.

set -eu
cd "$(dirname "$0")"

# icon.json's default fill, top to bottom.
BG_TOP='#f5f5f7'
BG_BOTTOM='#e2e2e8'

# The glyph drawn at 0.731 of its iOS size, so that its furthest point, a
# bottom corner of an ear cup, sits 0.30 of the canvas from the centre: inside
# the circle of 66 dp in 108 that every Android launcher mask leaves visible.
SIZE=748.5
AT=137.75

trap 'rm -f .export-*.svg' EXIT

background() {
  printf '%s' "<linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1024\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"$BG_TOP\"/><stop offset=\"1\" stop-color=\"$BG_BOTTOM\"/></linearGradient>"
}

layers() { # $1 = position, $2 = size, $3 = optional filter
  for layer in headphones wave; do
    printf '%s' "<image href=\"OpenReader.icon/Assets/$layer.svg\" x=\"$1\" y=\"$1\" width=\"$2\" height=\"$2\" $3/>"
  done
}

svg() { # $1 = name, $2 = body
  printf '%s\n' "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\" viewBox=\"0 0 1024 1024\">$2</svg>" > ".export-$1.svg"
  rsvg-convert ".export-$1.svg" -o "$1.png"
}

# The top-level `icon`: what an Android launcher too old for adaptive icons shows.
svg icon "<defs>$(background)</defs><rect width=\"1024\" height=\"1024\" fill=\"url(#bg)\"/>$(layers 0 1024 '')"

svg android-background "<defs>$(background)</defs><rect width=\"1024\" height=\"1024\" fill=\"url(#bg)\"/>"

svg android-foreground "$(layers $AT $SIZE '')"

# Android 13's themed icon reads only the alpha, so the glyph is painted white.
svg android-monochrome "<defs><filter id=\"white\"><feFlood flood-color=\"#fff\"/><feComposite in2=\"SourceAlpha\" operator=\"in\"/></filter></defs>$(layers $AT $SIZE 'filter="url(#white)"')"
