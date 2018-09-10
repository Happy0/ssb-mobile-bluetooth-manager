const BluetoothManagerPuppet = require('./puppet-bluetooth-manager');
const rn_bridge = require('rn-bridge');
const makeBluetoothPlugin = require('multiserver-bluetooth');

/**
 * A scuttlebot plugin for setting up a transport handler for 'bluetooth'
 * type connections
 */
module.exports = function (stack) {

  const puppetBluetoothManager = BluetoothManagerPuppet();

  const plugin = {
    name: 'bluetooth',
    create: () => {
      return makeBluetoothPlugin({
        bluetoothManager: puppetBluetoothManager
      })
    }
  }

    // Register 'bluetooth' multiserve transport handler in scuttlebot instance
    stack.multiserver.transport(plugin);

    // Listen for requests from the client across the react native bridge
    rn_bridge.channel.on('message', (msg) => {
      var message = JSON.parse(msg);

      // The react-native thread has asked us to issue a 'client connection'
      // request to scuttlebot
      if (message.type === "msClient") {
        const address = message.params.remoteAddress;

        // The mobile app has told us it wants to try to connect to a bluetooth address
        // TODO: signal connection error to client rather than just 'console.log'
        stack.connect("bt:" + address, (err, stream) => console.log("Err on connect b/t: " + err));
      }
    });
}
