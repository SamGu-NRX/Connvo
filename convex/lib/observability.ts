export async function withTrace<T>(
  ctx: any,
  name: string,
  f: () => Promise<T>,
) {
  const start = Date.now();
  try {
    const res = await f();
    // log metric name:ok with duration
    console.log(`${name}:ok duration=${Date.now() - start}ms`);
    return res;
  } catch (e) {
    // log metric name:err with duration
    console.log(`${name}:err duration=${Date.now() - start}ms error=${e}`);
    throw e;
  }
}
