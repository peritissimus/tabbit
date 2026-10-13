// Browser globals at the platform boundary. Feature adapters receive these
// explicitly; domain modules do not depend on Chrome's runtime.
declare const chrome: any;
declare const module: { exports: any };
interface Window { [name: string]: any; }
