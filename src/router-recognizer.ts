// Type definitions for RouteRecognizer 0.1.4
// Project: https://github.com/tildeio/route-recognizer

declare class RouteRecognizer {
    add(routes: Object[], options?: Object): void;
    map(callback: recognizer.Callback): void;
    recognize(path: string): recognizer.Result;
    hasRoute(name:string):boolean;
    generate(name:string, params:recognizer.Params):string;
    name:string;
}

declare module recognizer {
    interface Params {
      [key: string]: string;
      childRoute:string;
    }

    export interface Result extends Array<Handler> {
        queryParams: Params;
    }

    export interface Handler {
      handler: any;
      params: Params;
      isDynamic: boolean
      components:{[name:string]:string};
    }

    // route-recognizer/dsl.js
    interface Callback {
        (e: Match): void;
    }

    export interface Match {
        (path: string): Target;
        (path: string, e: Callback): Target;
    }

    export interface Target {
        to(handler: string): void;
        to(handler: Function): void;
    }
}
