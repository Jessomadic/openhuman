use super::*;

#[test]
fn cli_help_exits_zero() {
    assert!(run_stdio_from_cli(&["--help".into()]).is_ok());
}

#[test]
fn cli_verbose_advances_to_next_arg() {
    assert!(run_stdio_from_cli(&["--verbose".into(), "--help".into()]).is_ok());
}
