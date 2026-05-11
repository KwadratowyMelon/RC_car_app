import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  Switch,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import styles from './App.scss';
import { BleManager, Device } from 'react-native-ble-plx';
import base64 from 'react-native-base64';

// Initialize the BLE manager globally
const bleManager = new BleManager();

// The exact UUIDs we flashed to the ESP32-S3
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CHARACTERISTIC_UUID_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const App = () => {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [controlMode, setControlMode] = useState('dpad');

  const currentDrive = useRef('S');
  const currentSteer = useRef('C');

  const pan = useRef(new Animated.ValueXY()).current;
  const joystickRadius = 75; // max distance from center

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (e, gestureState) => {
        const distance = Math.sqrt(gestureState.dx ** 2 + gestureState.dy ** 2);
        let x = gestureState.dx;
        let y = gestureState.dy;

        // Constraint joystick to circle
        if (distance > joystickRadius) {
          x = (x / distance) * joystickRadius;
          y = (y / distance) * joystickRadius;
        }

        pan.setValue({ x, y });

        let newDrive = 'S';
        let newSteer = 'C';

        if (y < -30) newDrive = 'F';
        else if (y > 30) newDrive = 'B';

        if (x < -30) newSteer = 'L';
        else if (x > 30) newSteer = 'R';

        if (newDrive !== currentDrive.current) {
          sendCommand(newDrive);
          currentDrive.current = newDrive;
        }
        if (newSteer !== currentSteer.current) {
          sendCommand(newSteer);
          currentSteer.current = newSteer;
        }
      },
      onPanResponderRelease: () => {
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();

        if (currentDrive.current !== 'S') {
          sendCommand('S');
          currentDrive.current = 'S';
        }
        if (currentSteer.current !== 'C') {
          sendCommand('C');
          currentSteer.current = 'C';
        }
      },
    }),
  ).current;

  const dualLeftPan = useRef(new Animated.ValueXY()).current;
  const dualLeftResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (e, gestureState) => {
        // Landscape Left: Physical Y axis becomes user X axis.
        // User moves left/right = dy.
        let x = gestureState.dy;
        
        if (x > joystickRadius) x = joystickRadius;
        if (x < -joystickRadius) x = -joystickRadius;

        dualLeftPan.setValue({ x, y: 0 }); // Visual translation is mapped in UI

        let newSteer = 'C';
        if (x < -30) newSteer = 'L';
        else if (x > 30) newSteer = 'R';

        if (newSteer !== currentSteer.current) {
          sendCommand(newSteer);
          currentSteer.current = newSteer;
        }
      },
      onPanResponderRelease: () => {
        Animated.spring(dualLeftPan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        if (currentSteer.current !== 'C') {
          sendCommand('C');
          currentSteer.current = 'C';
        }
      }
    })
  ).current;

  const dualRightPan = useRef(new Animated.ValueXY()).current;
  const dualRightResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (e, gestureState) => {
        // Landscape Left: Physical X axis becomes user Y axis.
        // User moves up/down = -dx. (dx > 0 means moving right, which is up to the user).
        // Wait, physical dx > 0 means right edge of portrait -> "up" for user.
        // We want localY to be negative for "up" to match visual translation.
        // So localY = -dx.
        let y = -gestureState.dx;
        
        if (y > joystickRadius) y = joystickRadius;
        if (y < -joystickRadius) y = -joystickRadius;

        dualRightPan.setValue({ x: 0, y }); // Visual translation mapped in UI

        let newDrive = 'S';
        if (y < -30) newDrive = 'F';
        else if (y > 30) newDrive = 'B';

        if (newDrive !== currentDrive.current) {
          sendCommand(newDrive);
          currentDrive.current = newDrive;
        }
      },
      onPanResponderRelease: () => {
        Animated.spring(dualRightPan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        if (currentDrive.current !== 'S') {
          sendCommand('S');
          currentDrive.current = 'S';
        }
      }
    })
  ).current;

  useEffect(() => {
    requestPermissions();
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
      <View style={styles.header}>
        <Text style={styles.statusText}>Status: {connectionStatus}</Text>

        <View style={styles.toggleContainer}>
          <TouchableOpacity 
            style={[styles.toggleBtn, controlMode === 'dpad' && styles.toggleBtnActive]} 
            onPress={() => setControlMode('dpad')}>
            <Text style={[styles.toggleText, controlMode === 'dpad' && styles.toggleTextActive]}>D-Pad</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.toggleBtn, controlMode === 'joystick' && styles.toggleBtnActive]} 
            onPress={() => setControlMode('joystick')}>
            <Text style={[styles.toggleText, controlMode === 'joystick' && styles.toggleTextActive]}>Joystick</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.toggleBtn, controlMode === 'dual' && styles.toggleBtnActive]} 
            onPress={() => setControlMode('dual')}>
            <Text style={[styles.toggleText, controlMode === 'dual' && styles.toggleTextActive]}>Dual</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.controlsWrapper}>

      {controlMode === 'dpad' && (
        <View style={styles.dpad}>
          <TouchableOpacity
            style={styles.btn}
            onPressIn={() => sendCommand('F')}
            onPressOut={() => sendCommand('S')}
          >
            <Text style={styles.btnText}>▲</Text>
          </TouchableOpacity>

          <View style={styles.row}>
            <TouchableOpacity
              style={styles.btn}
              onPressIn={() => sendCommand('L')}
              onPressOut={() => sendCommand('C')}
            >
              <Text style={styles.btnText}>◀</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPressIn={() => sendCommand('R')}
              onPressOut={() => sendCommand('C')}
            >
              <Text style={styles.btnText}>▶</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.btn}
            onPressIn={() => sendCommand('B')}
            onPressOut={() => sendCommand('S')}
          >
            <Text style={styles.btnText}>▼</Text>
          </TouchableOpacity>
        </View>
      )}

      {controlMode === 'joystick' && (
        <View style={styles.joystickContainer}>
          <View style={styles.joystickBase}>
            <Animated.View
              style={[
                styles.joystickKnob,
                { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
              ]}
              {...panResponder.panHandlers}
            />
          </View>
        </View>
      )}

      {controlMode === 'dual' && (
        <View style={[styles.dualContainer, { width: screenHeight * 0.7, height: screenWidth }]}>
          <View style={styles.dualJoystickWrapper}>
            <Text style={styles.dualJoystickLabel}>STEERING</Text>
            <View style={styles.joystickBase}>
              <Animated.View
                style={[
                  styles.joystickKnob,
                  { transform: [{ translateX: dualLeftPan.x }, { translateY: dualLeftPan.y }] },
                ]}
                {...dualLeftResponder.panHandlers}
              />
            </View>
          </View>

          <View style={styles.dualJoystickWrapper}>
            <Text style={styles.dualJoystickLabel}>DRIVE</Text>
            <View style={styles.joystickBase}>
              <Animated.View
                style={[
                  styles.joystickKnob,
                  { transform: [{ translateX: dualRightPan.x }, { translateY: dualRightPan.y }] },
                ]}
                {...dualRightResponder.panHandlers}
              />
            </View>
          </View>
        </View>
      )}
      </View>
    </View>
  );
};

export default App;
