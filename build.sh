#!/bin/bash

SELF=$(cd `dirname $0`; pwd)

pushd $SELF
mkdir -p dist/static/ace local
cp node_modules/ace-builds/src-min/{ace.js,mode-javascript.js,mode-html.js,mode-css.js,mode-java.js,mode-c_cpp.js,mode-python.js,mode-ruby.js,mode-json.js,mode-yaml.js,mode-golang.js} dist/static/ace/
cp static/* dist/static
cp ./index.js dist/index.js
cp ./config.json dist/config.json
mkdir -p local
cd dist
zip -r ../local/nodebase-nodepad.zip *
cd ..
popd
