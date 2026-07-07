declare module 'react-native-sse' {
  export interface EventSourceOptions {
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    pollingInterval?: number;
  }

  export default class EventSource {
    constructor(url: string, options?: EventSourceOptions);
    addEventListener(type: string, listener: (event: any) => void): void;
    removeEventListener(type: string, listener: (event: any) => void): void;
    close(): void;
    removeAllEventListeners(): void;
  }
}
