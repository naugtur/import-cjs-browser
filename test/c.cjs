console.log("c start");
const b = require("./b");
const d = require("./d");

module.exports = {
  c: 1,
  b,
  d,
};

console.log("c end");
