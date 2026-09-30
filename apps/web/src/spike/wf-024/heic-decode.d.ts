// SPIKE (WF-024): heic-decode ships no types. Only the call the spike uses is declared.
declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel. */
    data: Uint8ClampedArray;
  }
  function decode(input: { buffer: Uint8Array | ArrayBuffer }): Promise<DecodedImage>;
  export default decode;
}
