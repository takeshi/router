
function copy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function forEach(obj: any, fn: Function) {
  Object.keys(obj).forEach(key => fn(obj[key], key));
}

function mapObj(obj: any, fn: Function): any[] {
  var result: any[] = [];
  Object.keys(obj).forEach(key => result.push(fn(obj[key], key)));
  return result;
}

function mapObjAsync(obj: any, fn: Function): Promise<any> {
  return Promise.all(mapObj(obj, fn));
}

function boolToPromise(value: any) {
  return value ? Promise.resolve(value) : Promise.reject(null);
}
