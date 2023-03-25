const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require('path');

module.exports = {
  entry: path.resolve(__dirname, "minesweeper.js"),
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "minesweeper.js",
  },
  mode: "production",
  plugins: [
    new CopyWebpackPlugin({
        patterns: [
            path.resolve(__dirname, 'index.html'),
            path.resolve(__dirname, 'minesweeper.css'),
            {from: path.resolve(__dirname, 'static'), to: 'static'}
        ]
    })
  ],
};
