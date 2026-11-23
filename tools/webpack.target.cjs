const path = require("path");
const webpack = require("/usr/share/nodejs/webpack");
module.exports = (env) => ({
  mode: "production",
  entry: env.entry,
  output: { path: path.resolve(env.outDir), filename: env.outFile },
  plugins: env.noAdmin ? [new webpack.NormalModuleReplacementPlugin(/admin\.module\.js/, path.resolve("js/modules/admin/admin.stub.js"))] : []
});
