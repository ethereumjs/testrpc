#!/usr/bin/env node
// `yargs/yargs` required to work with webpack, see here.
// https://github.com/yargs/yargs/issues/781
var yargs = require('yargs/yargs');
var Ganache = require("ganache-core");
var enableDestroy = require("server-destroy");
var pkg = require("./package.json");
var corepkg = require("./node_modules/ganache-core/package.json");
var URL = require("url");
var Web3 = require("web3");
var web3 = new Web3(); // Used only for its BigNumber library.

var parser = yargs()
.option("unlock", {
  type: "string",
  alias: "u"
});

var argv = parser.parse(process.argv);

function parseAccounts(accounts) {
  function splitAccount(account) {
    account = account.split(',')
    return {
      secretKey: account[0],
      balance: account[1]
    };
  }

  if (typeof accounts === 'string')
    return [ splitAccount(accounts) ];
  else if (!Array.isArray(accounts))
    return;

  var ret = []
  for (var i = 0; i < accounts.length; i++) {
    ret.push(splitAccount(accounts[i]));
  }
  return ret;
}

if (argv.d || argv.deterministic) {
  argv.s = "TestRPC is awesome!"; // Seed phrase; don't change to Ganache, maintain original determinism
}

if (typeof argv.unlock == "string") {
  argv.unlock = [argv.unlock];
}

var logger = console;

// If the mem argument is passed, only show memory output,
// not transaction history.
if (argv.mem === true) {
  logger = {
    log: function() {}
  };

  setInterval(function() {
    console.log(process.memoryUsage());
  }, 1000);
}

var options = {
  port: argv.p || argv.port || "8545",
  hostname: argv.h || argv.hostname,
  debug: argv.debug,
  seed: argv.s || argv.seed,
  mnemonic: argv.m || argv.mnemonic,
  total_accounts: argv.a || argv.accounts,
  blocktime: argv.b || argv.blocktime,
  gasPrice: argv.g || argv.gasPrice,
  gasLimit: argv.l || argv.gasLimit,
  accounts: parseAccounts(argv.account),
  unlocked_accounts: argv.unlock,
  fork: argv.f || argv.fork || false,
  network_id: argv.i || argv.networkId,
  verbose: argv.v || argv.verbose,
  secure: argv.n || argv.secure || false,
  db_path: argv.db || null,
  logger: logger
}

var fork_address;

// If we're forking from another client, don't try to use the same port.
if (options.fork) {
  var split = options.fork.split("@");
  fork_address = split[0];
  var block;
  if (split.length > 1) {
    block = split[1];
  }

  if (URL.parse(fork_address).port == options.port) {
    options.port = (parseInt(options.port) + 1);
  }

  options.fork = fork_address + (block != null ? "@" + block : "");
}

var server = Ganache.server(options);
enableDestroy(server);

//console.log("Ganache CLI v" + pkg.version);
console.log("EthereumJS TestRPC v" + pkg.version + " (ganache-core: " + corepkg.version + ")");

server.listen(options.port, options.hostname, function(err, state) {
  if (err) {
    console.log(err);
    return;
  }
  console.log("");
  console.log("Available Accounts");
  console.log("==================");

  var accounts = state.accounts;
  var addresses = Object.keys(accounts);

  addresses.forEach(function(address, index) {
    var line = "(" + index + ") " + address;

    if (state.isUnlocked(address) == false) {
      line += " 🔒";
    }

    console.log(line);
  });

  console.log("");
  console.log("Private Keys");
  console.log("==================");

  addresses.forEach(function(address, index) {
    console.log("(" + index + ") " + accounts[address].secretKey.toString("hex"));
  });

  if (options.accounts == null) {
    console.log("");
    console.log("HD Wallet");
    console.log("==================");
    console.log("Mnemonic:      " + state.mnemonic);
    console.log("Base HD Path:  " + state.wallet_hdpath + "{account_index}")
  }

  if (options.gasPrice) {
    console.log("");
    console.log("Gas Price");
    console.log("==================");
    console.log(options.gasPrice);
  }

  if (options.gasLimit) {
    console.log("");
    console.log("Gas Limit");
    console.log("==================");
    console.log(options.gasLimit);
  }

  if (options.fork) {
    console.log("");
    console.log("Forked Chain");
    console.log("==================");
    console.log("Location:    " + fork_address);
    console.log("Block:       " + web3.toBigNumber(state.blockchain.fork_block_number).toString(10));
    console.log("Network ID:  " + state.net_version);
    console.log("Time:        " + (state.blockchain.startTime || new Date()).toString());
  }

  console.log("");
  console.log("Listening on " + (options.hostname || "localhost") + ":" + options.port);
});

process.on('uncaughtException', function(e) {
  console.log(e.stack);
  process.exit(1);
})

// See http://stackoverflow.com/questions/10021373/what-is-the-windows-equivalent-of-process-onsigint-in-node-js
if (process.platform === "win32") {
  require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  })
  .on("SIGINT", function () {
    process.emit("SIGINT");
  });
}

process.on("SIGINT", function () {
  // graceful shutdown
  server.destroy(function(err) {
    if (err) {
      console.log(err.stack || err);
    }
    process.exit();
  });
});
