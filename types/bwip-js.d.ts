declare module "bwip-js" {
  export type BwipOptions = {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    backgroundcolor?: string;
    [key: string]: string | number | boolean | undefined;
  };

  const bwipjs: {
    toCanvas(canvas: HTMLCanvasElement | string, options: BwipOptions): HTMLCanvasElement;
  };

  export default bwipjs;
}
