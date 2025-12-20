console.log("a start");
const b = require("./b");
const c = require("./c");

module.exports = {
  a: 1,
  b,
  c,
};

console.log("a end");
