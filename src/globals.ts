export type webOSLaunchParams = Record<string, unknown>;

declare global {
  /** YouTube Data API key for the trends tabs, from YTAF_TRENDS_KEY at build time. */
  const __YTAF_TRENDS_KEY__: string;

  interface Window {
    launchParams?: webOSLaunchParams;
    __ytaf_debug__?: boolean;
  }

  interface Document {
    addEventListener(
      eventName: 'webOSRelaunch',
      listener: (evt: CustomEvent<webOSLaunchParams>) => void,
      useCapture?: boolean
    ): void;
  }
}
