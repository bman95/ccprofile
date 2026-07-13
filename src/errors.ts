/**
 * An error whose message is meant for the user (bad input, refused operation,
 * missing profile, …). The CLI prints only the message for these; any other
 * error type is unexpected and gets its full stack trace printed so bugs are
 * actionable instead of a cryptic one-liner.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
