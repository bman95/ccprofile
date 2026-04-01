declare module "write-file-atomic" {
  interface Options {
    encoding?: BufferEncoding;
    mode?: number;
    chown?: { uid: number; gid: number };
  }
  export default function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options?: Options
  ): Promise<void>;
}
