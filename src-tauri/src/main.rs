// Binary entry point; all logic lives in the library crate so it can be tested.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    groundwork_lib::run();
}
