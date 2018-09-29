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

      // Tell the other side of the bridge the bluetooth device to connect to.
      socket.write(address, () => {
        cb(null, toPull.duplex(socket));
      });

    }).on('error', function (err) {
      console.log("err?", err)
      if(started) return
      started = true
      cb(err)
    });

    return function () {
      started = true
      socket.destroy();
      cb(new Error("multiserv bt bridge aborted."))
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
