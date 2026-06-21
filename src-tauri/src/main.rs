// На Windows под release-сборкой прячем консольное окно.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    shooting_analyser_lib::run()
}
