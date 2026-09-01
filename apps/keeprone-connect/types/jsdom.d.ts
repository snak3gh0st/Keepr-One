declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string })
    readonly window: Window & {
      readonly document: Document
      readonly location: Location
    }
  }
}
