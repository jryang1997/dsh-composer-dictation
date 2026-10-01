/**
 * Host half of the hold-to-dictate bundle.
 *
 * Every behaviour lives in the Client module (`./client`): the composer card, the
 * pointer gesture, the recording meter and the draft insertion are all browser
 * concerns, and transcription goes through the `speech` Remote that the shipped
 * voice-input bundle already mounts. This half therefore registers nothing.
 */
export function apply() {}
