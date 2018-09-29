const pull = require('pull-stream');

const Pushable = require('pull-pushable');

const rn_bridge = require('rn-bridge');
const Abortable = require('pull-abortable');

const net = require('net');
const toPull = require('stream-to-pull-stream');

function makeManager () {

  function connect(address, cb) {

    var started = false;

    var socket = net.connect({
      path: manyverse_bt_outgoing
    }).on('connect', function () {
      if(started) return

      socket.write(address);

      cb(null, toPull.duplex(socket));

    }).on('error', function (err) {
      console.log("err?", err)
      if(started) return
      started = true
      cb(err)
    });

    return function () {
      console.log("todo")
    }

  }

  function listenForIncomingConnections(onConnection) {

    // todo

    var bridgeMsg = {
      type: "listenIncoming",
      params: {}
    }

    rn_bridge.channel.send(JSON.stringify(bridgeMsg));
    
  }

  return {
    connect,
    listenForIncomingConnections
  }

}

module.exports = makeManager;
