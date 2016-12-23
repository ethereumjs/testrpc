var BlockchainDouble = require("../blockchain_double.js");
var VM = require("ethereumjs-vm");
var Account = require("ethereumjs-account");
var Block = require("ethereumjs-block");
var Blockchain = require('ethereumjs-blockchain');
var Log = require("./log.js");
var utils = require("ethereumjs-util");
var ForkedStorageTrie = require("./forkedstoragetrie.js");
var FakeTransaction = require('ethereumjs-tx/fake.js');
var Web3 = require("web3");
var to = require("./to.js");
var async = require("async");
var txhelper = require("./txhelper.js")

var inherits = require("util").inherits;

inherits(ForkedBlockchain, BlockchainDouble);

function ForkedBlockchain(options) {
  var self = this;

  options = options || {};

  if (options.fork == null) {
    throw new Error("ForkedBlockchain must be passed a fork parameter.");
  }

  this.fork = options.fork;
  this.fork_block_number = options.fork_block_number;
  this.fork_version = null;

  if (typeof this.fork == "string") {
    if (this.fork.indexOf("@") >= 0) {
      var split = this.fork.split("@");
      this.fork = split[0];
      this.fork_block_number = parseInt(split[1]);
    }

    this.fork = new Web3.providers.HttpProvider(this.fork);
  }

  this.time = options.time;
  this.storageTrieCache = {};

  options.trie = new ForkedStorageTrie(null, null, {
    fork: this.fork,
    fork_block_number: this.fork_block_number,
    blockchain: this
  });

  BlockchainDouble.call(this, options);

  // Unfortunately this requires a bit of monkey patching, but it gets the job done.
  //this.vm.stateManager._getStorageTrie = this.lookupStorageTrie.bind(this);
  this.vm.stateManager._lookupStorageTrie = this.lookupStorageTrie.bind(this);
  this.vm.stateManager.cache._lookupAccount = this.getAccount.bind(this);
  this.vm.stateManager.getContractCode = this.getCode.bind(this);
  this.vm.stateManager.putContractCode = this.putCode.bind(this);

  this.web3 = new Web3(this.fork);
};


ForkedBlockchain.prototype.initialize = function(accounts, callback) {
  var self = this;
  function waitForBlockchainInit() {
    if(self.blockchain._initDone) {
      self.__initialize(accounts, callback);
    } else {
      setTimeout(waitForBlockchainInit, 100);
    }
  }
  self.blockchain = new Blockchain(self.db, false);
  waitForBlockchainInit();
}

ForkedBlockchain.prototype.__initialize = function(accounts, callback) {
  var self = this;

  var blockNumber = this.fork_block_number || "latest";

  this.web3.version.getNetwork(function(err, version) {
    if (err) return callback(err);

    self.fork_version = version;

    if(typeof blockNumber == "string" && blockNumber[1] === "x" && blockNumber.length < 42) blockNumber = parseInt(blockNumber)
    self.web3.eth.getBlock(blockNumber, function(err, json) {
      if (err) return callback(err);

      var block = new Block();
      block.header.parentHash = utils.toBuffer(json.hash);
      block.header.stateRoot = utils.toBuffer(json.stateRoot);
      block.header.difficulty = utils.toBuffer('0x00');
      block.header.gasLimit = utils.toBuffer(json.gasLimit);
      block.header.number = utils.toBuffer(json.number + 1);
      block.header.timestamp = utils.toBuffer(json.timestamp)

      // If no start time was passed, set the time to where we forked from.
      // We only want to do this if a block was explicitly passed. If a block
      // number wasn't passed, then we're using the last block and the current time.
      if (!self.time && self.fork_block_number) {
        self.time = new Date(to.number(json.timestamp) * 1000);
        self.setTime(self.time);
      }

      // Update the relevant block numbers
      self.fork_block_number = to.hex(json.number);
      self.stateTrie.fork_block_number = to.hex(json.number);

      BlockchainDouble.prototype.initialize.call(self, accounts, block, callback);
    });
  });
};

ForkedBlockchain.prototype.createForkedStorageTrie = function(address) {
  address = to.hex(address);

  var trie = new ForkedStorageTrie(null, null, {
    address: address,
    stateTrie: this.stateTrie,
    blockchain: this,
    fork: this.fork,
    fork_block_number: this.fork_block_number
  });

  this.storageTrieCache[address] = trie;

  return trie;
};

ForkedBlockchain.prototype.lookupStorageTrie = function(address, callback) {
  var self = this

  address = to.hex(address);

  if (this.storageTrieCache[address] != null) {
    return callback(null, this.storageTrieCache[address]);
  }

  callback(null, this.createForkedStorageTrie(address));
};

ForkedBlockchain.prototype.getBlock = function(number, callback) {
  var self = this;

  function isBlockHash(value) {
    return typeof value == "string" && value.indexOf("0x") == 0 && value.length > 42;
  }

  function isFallbackBlockHash(value, cb) {
    if( !isBlockHash(value) ) return cb(null, false);
    try{
    self.blockchain.getBlock(utils.toBuffer(value), (err, block) => {
      cb(null, !!err || !block);
    });
    } catch(e) {
      cb(null, true);
    }
  }

  function isFallbackBlock(value) {
    value = self.getEffectiveBlockNumber(value);
    return value <= to.number(self.fork_block_number);
  }

  function getFallbackBlock(number_or_hash, cb) {
    
    if(typeof number_or_hash == "string" && number_or_hash[1] === "x" && number_or_hash.length < 42) number_or_hash = parseInt(number_or_hash)
    self.web3.eth.getBlock(number_or_hash, true, function(err, json) {
      if (err) return cb(err);

      if (json == null) return cb();

      var block = new Block();

      block.header.parentHash = utils.toBuffer(json.parentHash);
      block.header.uncleHash = utils.toBuffer(json.sha3Uncles);
      block.header.coinbase = utils.toBuffer(json.miner);
      block.header.stateRoot = utils.toBuffer(json.stateRoot); // Should we include the following three?
      block.header.transactionTrie = utils.toBuffer(json.transactionsRoot);
      block.header.receiptTrie = utils.toBuffer(json.receiptsRoot);
      block.header.bloom = utils.toBuffer(json.logsBloom);
      block.header.difficulty = utils.toBuffer("0x" + json.totalDifficulty.toString(16)); // BigNumber
      block.header.number = utils.toBuffer(json.number);
      block.header.gasLimit = utils.toBuffer(json.gasLimit);
      block.header.gasUsed = utils.toBuffer(json.gasUsed);
      block.header.timestamp = utils.toBuffer(json.timestamp);
      block.header.extraData = utils.toBuffer(json.extraData);

      (json.transactions || []).forEach(function(tx_json, index) {
        // TODO - hack
        if(typeof tx_json === "object") {
          var tx = txhelper.fromJSON(tx_json);
          block.transactions.push(tx);
        }
      });

      // Fake block. Let's do the worst.
      // TODO: Attempt to fill out all block data so as to produce the same hash! (can we?)
      block.hash = function() {
        return utils.toBuffer(json.hash);
      }

      cb(null, block);
    });
  }

  isFallbackBlockHash(number, (err, res) => {
    if (res || isFallbackBlock(number)) {
      return getFallbackBlock(number, callback);
    } else {
      if (!isBlockHash(number)) {
        number = this.getEffectiveBlockNumber(number);
      }

      return BlockchainDouble.prototype.getBlock.call(this, number, callback);
    }
  });
};

ForkedBlockchain.prototype.getStorage = function(address, key, number, callback) {
  this.lookupStorageTrie(address, function(err, trie) {
    if (err) return callback(err);
    trie.get(key, callback);
  });
};

ForkedBlockchain.prototype.getCode = function(address, number, callback) {
  var self = this;

  if (typeof number == "function") {
    callback = number;
    number = this.getEffectiveBlockNumber("latest");
  }

  if (!number) {
    number = this.getEffectiveBlockNumber("latest");
  }

  number = this.getEffectiveBlockNumber(number);

  this.stateTrie.keyExists(address, function(err, exists) {
    if (exists && number > to.number(self.fork_block_number)) {
      BlockchainDouble.prototype.getCode.call(self, address, number, callback);
    } else {

      if (number > to.number(self.fork_block_number)) {
        number = "latest";
      }

      self.fetchCodeFromFallback(address, number, function(err, code) {
        if (code) {
          code = utils.toBuffer(code);
        }
        callback(err, code);
      });
    }
  });
};

ForkedBlockchain.prototype.putCode = function(address, value, callback) {
  // This is a bit of a hack. We need to bypass the vm's
  // _lookupAccount call that vm.stateManager.putContractCode() uses.
  // This means we have to do somethings ourself. The last call
  // to self.stateTrie.put() at the bottom is important because
  // we can't just be satisfied putting it in the cache.

  var self = this;
  address = utils.toBuffer(address);
  this.stateTrie.get(address, function(err, data) {
    if (err) return callback(err);

    var account = new Account(data);
    account.setCode(self.stateTrie, value, function(err, result) {
      if (err) return callback(err);

      self.stateTrie.put(address, account.serialize(), function(err) {
        if (err) return callback(err);

        // Ensure the cache updates as well.
        self.vm.stateManager._putAccount(address, account, callback);
      });
    });
  })
};

ForkedBlockchain.prototype.getAccount = function(address, number, callback) {
  var self = this;

  if (typeof number == "function") {
    callback = number;
    number = "latest";
  }

  // If the account doesn't exist in our state trie, get it off the wire.
  this.stateTrie.keyExists(address, function(err, exists) {
    if (err) return callback(err);

    if (exists && self.getEffectiveBlockNumber(number) > to.number(self.fork_block_number)) {
      BlockchainDouble.prototype.getAccount.call(self, address, number, function(err, acc) {
        if (err) return callback(err);
        callback(null, acc);
      });
    } else {
      self.fetchAccountFromFallback(address, number, callback);
    }
  });
};

ForkedBlockchain.prototype.getTransaction = function(hash, callback) {
  var self = this;
  BlockchainDouble.prototype.getTransaction.call(this, hash, function(err, tx) {
    if (err) return callback(err);
    if (tx != null) return callback(null, tx);

    self.web3.eth.getTransaction(hash, callback);
  });
};

ForkedBlockchain.prototype.getTransactionReceipt = function(hash, callback) {
  var self = this;
  BlockchainDouble.prototype.getTransactionReceipt.call(this, hash, function(err, receipt) {
    if (err) return callback(err);
    if (receipt) return callback(null, receipt);

    self.web3.eth.getTransactionReceipt(hash, callback);

  });
};

ForkedBlockchain.prototype.fetchAccountFromFallback = function(address, block_number, callback) {
  var self = this;
  address = to.hex(address);

  async.parallel({
    code: this.fetchCodeFromFallback.bind(this, address, block_number),
    balance: this.fetchBalanceFromFallback.bind(this, address, block_number),
    nonce: this.fetchNonceFromFallback.bind(this, address, block_number)
  }, function(err, results) {
    if (err) return callback(err);

    var code = results.code;
    var balance = results.balance;
    var nonce = results.nonce;

    var account = new Account({
      nonce: nonce,
      balance: balance
    });

    account.exists = code != "0x0" || balance != "0x0" || nonce != "0x0";

    // This puts the code on the trie, keyed by the hash of the code.
    // It does not actually link an account to code in the trie.
    account.setCode(self.stateTrie, utils.toBuffer(code), function(err) {
      if (err) return callback(err);
      callback(null, account);
    });
  });
};

ForkedBlockchain.prototype.fetchCodeFromFallback = function(address, block_number, callback) {
  var self = this;
  address = to.hex(address);

  // Allow an optional block_number
  if (typeof block_number == "function") {
    callback = block_number;
    block_number = this.fork_block_number;
  }

  block_number = this.getSafeFallbackBlockNumber(block_number);

  this.web3.eth.getCode(address, block_number, function(err, code) {
    if (err) return callback(err);

    code = "0x" + utils.toBuffer(code).toString("hex");
    callback(null, code);
  });
}

ForkedBlockchain.prototype.fetchBalanceFromFallback = function(address, block_number, callback) {
  var self = this;
  address = to.hex(address);

  // Allow an optional block_number
  if (typeof block_number == "function") {
    callback = block_number;
    block_number = this.fork_block_number;
  }

  block_number = this.getSafeFallbackBlockNumber(block_number);

  this.web3.eth.getBalance(address, block_number, function(err, balance) {
    if (err) return callback(err);

    balance = "0x" + balance.toString(16); // BigNumber
    callback(null, balance);
  });
}

ForkedBlockchain.prototype.fetchNonceFromFallback = function(address, block_number, callback) {
  var self = this;
  address = to.hex(address);

  // Allow an optional block_number
  if (typeof block_number == "function") {
    callback = block_number;
    block_number = this.fork_block_number;
  }

  block_number = this.getSafeFallbackBlockNumber(block_number);

  this.web3.eth.getTransactionCount(address, block_number, function(err, nonce) {
    if (err) return callback(err);

    nonce = "0x" + self.web3.toBigNumber(nonce).toString(16);
    callback(null, nonce);
  });
}

ForkedBlockchain.prototype.getSafeFallbackBlockNumber = function(block_number) {
  var fork_block_number = to.number(this.fork_block_number);

  if (block_number == null) return fork_block_number;

  var number = this.getEffectiveBlockNumber(block_number);

  if (number > fork_block_number) {
    number = fork_block_number
  }

  return number;
};

ForkedBlockchain.prototype.getBlockLogs = function(number, callback) {
  var self = this;

  var relative = this.getEffectiveBlockNumber(number);
  if (relative <= parseInt(this.fork_block_number)) {
    this.getBlock(number, function(err, block) {
      if (err) return callback(err);

      self.web3.currentProvider.sendAsync({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{
          fromBlock: to.hex(number),
          toBlock: to.hex(number)
        }],
        id: new Date().getTime()
      }, function(err, res) {
        if (err) return callback(err);

        var logs = res.result.map(function(log) {
          // To make this result masquerade as the right information.
          log.block = block;
          return new Log(log);
        });

        callback(null, logs);
      });
    });
  } else {
    BlockchainDouble.prototype.getBlockLogs.call(this, relative, callback);
  }
};

ForkedBlockchain.prototype.getLogs = function (filter, callback) {

  var self = this;

  var expectedAddress = filter.address;
  var expectedTopics = filter.topics || [];
  var fromBlock = this.blockchain.getEffectiveBlockNumber(filter.fromBlock || "latest");
  var toBlock = this.blockchain.getEffectiveBlockNumber(filter.toBlock || "latest");

  if( fromBlock < this.blockchain.getEffectiveBlockNumber(this.blockchain.fork_block_number)) {
    current = this.blockchain.getEffectiveBlockNumber(this.blockchain.fork_block_number) + 1;
    toFetch = true;
  }

  async.whilst(function() {
    return current <= toBlock;
  }, function(finished) {
    self.blockchain.getBlockLogs(current, function(err, blockLogs) {
      if (err) return finished(err);

      // Filter logs that match the address
      var filtered = blockLogs.filter(function(log) {
        return (expectedAddress == null || log.address == expectedAddress);
      });

      // Now filter based on topics.
      filtered = filtered.filter(function(log) {
        var keep = true;
        for (var i = 0; i < expectedTopics.length; i++) {
          if (expectedTopics[i] == null) continue;
          if (i >= log.topics.length || expectedTopics[i] != log.topics[i]) {
            keep = false;
            break;
          }
        }
        return keep;
      });

      logs.push.apply(logs, filtered);

      current += 1;
      finished();
    });
  }, function(err) {
    if (err) return callback(err);

    if(toFetch) {
      self.blockchain.web3.eth
      .filter(filter)
      .get((err, res) => {
        if(!err) logs = logs.concat(res);
        callback(err, logs);
      });
    } else {
      callback(err, logs);
    }
  });

}

ForkedBlockchain.prototype._checkpointTrie = function() {
  var self = this;

  BlockchainDouble.prototype._checkpointTrie.call(this);

  Object.keys(this.storageTrieCache).forEach(function(address) {
    var trie = self.storageTrieCache[address];
    trie.customCheckpoint();
  });
};

ForkedBlockchain.prototype._revertTrie = function() {
  var self = this;

  BlockchainDouble.prototype._revertTrie.call(this);

  Object.keys(this.storageTrieCache).forEach(function(address) {
    var trie = self.storageTrieCache[address];

    // We're trying to revert to a point before this trie was created.
    // Let's just remove the trie.
    if (trie.checkpoints.length == 0) {
      delete self.storageTrieCache[address];
    } else {
      trie.customRevert();
    }
  });
};

module.exports = ForkedBlockchain;
