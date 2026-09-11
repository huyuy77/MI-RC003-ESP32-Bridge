# MI-RC003-ESP32-Bridge
# ESP-IDF project: Xiaomi Bluetooth Remote 2 Pro (RC003) -> USB HID + UAC microphone bridge
# with a browser-based WebUSB configuration interface (replaces the Wi-Fi AP web server).
cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(mi_rc003_bridge)
