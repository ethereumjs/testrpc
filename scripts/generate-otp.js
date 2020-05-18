// we want to generate a TOTP in the _future_, and the `notp`
// library doesn't let us do that unless we set `NODE_ENV = "test"`
process.env.NODE_ENV = "test";

const b32 = require("thirty-two");
const notp = require("notp");
const bin = b32.decode(process.env.NPM_OTP_KEY);
// generate a code 5 seconds in the future
// 5 seconds is arbitrary, and may need to be tweaked if
// the release process is discovered to be too fast or too slow.
const timeOffset = 5000;
const now = Date.now();
const time = now + timeOffset;
// _t is the time at which we want the OTP to be valid for
console.log(notp.totp.gen(bin, {_t: time}));
