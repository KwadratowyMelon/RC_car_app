import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  StyleSheet,
} from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import base64 from 'react-native-base64';

// Initialize the BLE manager globally
const bleManager = new BleManager();

// The exact UUIDs we flashed to the ESP32-S3
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CHARACTERISTIC_UUID_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

const App = () => {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  useEffect(() => {
    requestPermissions();
    return () => bleManager.destroy(); // Cleanup on unmount
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      if (
        granted['android.permission.BLUETOOTH_CONNECT'] ===
        PermissionsAndroid.RESULTS.GRANTED
      ) {
        scanForCar();
      } else {
        setConnectionStatus('Permissions denied');
      }
    }
  };

  const scanForCar = () => {
    setConnectionStatus('Scanning for ESP32S3_RWD_Car...');
    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error(error);
        setConnectionStatus('Scan Error');
        return;
      }

      // Check if this is our car
      if (device && device.name === 'ESP32S3_RWD_Car') {
        bleManager.stopDeviceScan(); // Stop scanning once found
        connectToCar(device);
      }
    });
  };

  const connectToCar = async (device: Device) => {
    try {
      setConnectionStatus('Connecting...');
      const connected = await device.connect();

      setConnectionStatus('Discovering Services...');
      // Crucial step: The phone must discover the GATT structure before it can write to it
      await connected.discoverAllServicesAndCharacteristics();

      setConnectedDevice(connected);
      setConnectionStatus('Connected & Ready to Drive!');
    } catch (error) {
      console.error('Connection failed', error);
      setConnectionStatus('Connection Failed');
    }
  };

  const sendCommand = async (command: string) => {
    if (!connectedDevice) return;

    try {
      // ble-plx requires the payload to be Base64 encoded
      const base64Command = base64.encode(command);

      await connectedDevice.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID_RX,
        base64Command,
      );
      console.log(`Sent command: ${command}`);
    } catch (error) {
      console.error('Failed to send command', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>Status: {connectionStatus}</Text>

      {/* Basic D-Pad Layout */}
      <View style={styles.dpad}>
        <TouchableOpacity
          style={styles.btn}
          onPressIn={() => sendCommand('F')}
          onPressOut={() => sendCommand('S')}
        >
          <Text style={styles.btnText}>Forward</Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPressIn={() => sendCommand('L')}
            onPressOut={() => sendCommand('C')}
          >
            <Text style={styles.btnText}>Left</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btn}
            onPressIn={() => sendCommand('R')}
            onPressOut={() => sendCommand('C')}
          >
            <Text style={styles.btnText}>Right</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.btn}
          onPressIn={() => sendCommand('B')}
          onPressOut={() => sendCommand('S')}
        >
          <Text style={styles.btnText}>Reverse</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  statusText: { color: '#00ff00', marginBottom: 40, fontSize: 16 },
  dpad: { alignItems: 'center' },
  row: {
    flexDirection: 'row',
    width: 250,
    justifyContent: 'space-between',
    marginVertical: 10,
  },
  btn: {
    backgroundColor: '#333',
    padding: 20,
    borderRadius: 10,
    width: 100,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: 'bold' },
});

export default App;
