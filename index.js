/**
 * import cjs in the browser
 *
 * How to make the require function behavior synchronous?
 * Facts:
 * 1. we know the entry module first
 * 2. entry module must run to reveal what is required
 * 3. loading modules is async
 * 4. we only have exports once the module runs
 *
 * but who says it must only run once?
 *
 * Phase one
 * - shim require globally
 * - return polite proxies
 * - collect specifiers
 * - discard the module
 *
 * With that, go down the tree recursively, catch and ignore errors
 *
 * Phase two
 * - start from modules without dependencies
 * - import them under a working require shim
 * - save their exports
 * - go up the tree until done
 *
 * Cycles might hurt
 *
 */

(function () {
  const { create, defineProperty, freeze, keys } = Object;
  const { log, error } = console;
  const assert = (cond, txt) => {
    if (!cond) {
      throw Error(txt || "Assertion failed");
    }
  };

  const basePath = new URL(location.href).pathname;
  log({ basePath });

  // the goal here is to delay getting an error as long as possible
  const politeProxy = () =>
    new Proxy(function () {}, {
      has: () => true,
      get: () => politeProxy(),
    });

  const resolve = (specifier) => {
    // FIXME: I don't want to do this right now for a PoC
    // leaving this as an exercise for the reader
    return specifier.replace(/^\.\//, basePath) + ".js";
  };

  const gimmeRealm = () => {
    const i = document.createElement("iframe");
    // messing with the document could potentially be avoided, I don't remember
    document.body.append(i);
    const w = i.contentWindow;
    return {
      global: w.globalThis,
      // makes me think workers would be great for this because they do importScripts
      // but the communication would end up being async anyway
      async importScript(location) {
        const idoc = i.contentDocument;
        const scr = idoc.createElement("script");
        // reminds me how I would do scr instead of src in HTML as a kid :D
        scr.src = location;
        const done = new Promise((resolve) => {
          scr.onload = () => {
            log("script loaded", location);
            resolve();
          };
          scr.onerror = () => {
            log("script error", location);
            resolve();
          };
        });
        i.contentDocument.head.append(scr);
        return done.then(() => {
          document.body.removeChild(i);
        });
      },
    };
  };
  const recordRequires = (children) => (specifier) => {
    log("require", specifier);
    // save the specifier (and parent)
    children.push(specifier);
    return politeProxy();
  };

  const detonate = async (specifier) => {
    const data = {
      specifier,
      children: [],
    };
    // this should be happening in an iframe or a worker
    const realm = gimmeRealm();
    realm.global.exports = {};
    realm.global.module = { exports: realm.global.exports };
    realm.global.require = recordRequires(data.children);

    log("i", specifier);
    return realm.importScript(resolve(specifier)).then(() => data);
  };

  const createGraph = async (entrySpecifier) => {
    const visitedSpecifiers = new Set();
    const noDependencies = new Set();
    /** @type {[string, string[]][]} */
    const graph = [];
    const queue = [entrySpecifier];
    while (queue.length > 0) {
      log(">>", queue.join());
      const next = queue.shift();
      // I'm assuming this eliminates cycles and duplicates, but didn't think too hard about it
      if (!visitedSpecifiers.has(next)) {
        visitedSpecifiers.add(next);
        const { specifier, children } = await detonate(next);
        log("+++", specifier, children);
        if (children.length > 0) {
          queue.push(...children);
        } else {
          noDependencies.add(specifier);
        }
        graph.push([specifier, children]);
      }
    }
    return {
      graph,
      noDependencies: Array.from(noDependencies),
    };
  };

  // --------------------------------------
  // import
  // --------------------------------------
  const moduleCache = create(null);

  const OWN_STACK_DEPTH = 3;

  const whosthere = (stack) => {
    // figure out module name from stack
    // skip the frames of our own implementation and pick the file locaiton from the caller
    // the depth of own stack should be fixed
    const frames = stack.split("\n");
    const callerFrame = frames[OWN_STACK_DEPTH];
    const match = callerFrame.match(/at (.+):(\d+):(\d+)/);
    if (match) {
      const [, file] = match;
      log("whosthere: ", file);
      return file;
    }
    throw new Error("Failed to determine module name fom " + callerFrame);
  };

  // make exports a proxy and whenever assigned, it'll check who did that with a stack trace and save to the matching module namespace.
  const MODULE = {};

  defineProperty(globalThis, "module", {
    value: MODULE,
    configurable: false,
    enumerable: false,
  });

  const getExports = () => {
    const id = whosthere(Error().stack);
    const cachedModule = moduleCache[id];
    if (cachedModule) {
      return cachedModule.exports;
    }
    const exports = {};
    moduleCache[id] = { exports };
    return exports;
  };
  const ensureExport = () => {
    const id = whosthere(Error().stack);
    const cachedModule = moduleCache[id];
    if (!cachedModule) {
      moduleCache[id] = { exports: {} };
    }
    return id;
  };

  // I'm too impatient to implement this properly now
  const awfullyNaiveResolve = (specifier) => {
    specifier = specifier.replace(/^\./, "test");
    const matchingKeys = keys(moduleCache).filter((key) =>
      key.includes(specifier),
    );
    if (matchingKeys.length === 0) {
      return null;
    }
    return matchingKeys[0];
  };

  defineProperty(MODULE, "exports", {
    get() {
      return getExports();
    },
    set(v) {
      const id = ensureExport();
      moduleCache[id] = { exports: v };
      return true;
    },
    configurable: false,
    enumerable: true,
  });
  freeze(MODULE);

  defineProperty(globalThis, "exports", {
    get() {
      return getExports();
    },
    configurable: false,
    enumerable: false,
  });

  const REQUIRE = (specifier) => {
    const id = awfullyNaiveResolve(specifier);
    return moduleCache[id].exports;
  };

  defineProperty(globalThis, "require", {
    value: REQUIRE,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // omg so inefficient
  const findNext = (graph, executed) => {
    return graph.find(
      ([specifier, children]) =>
        children.every(
          (child) => !!moduleCache[awfullyNaiveResolve(child)]?.exports,
        ) && !executed.has(specifier),
    );
  };

  // graph execution
  const bottomUpExecute = async ({ graph, noDependencies }) => {
    // execute each leaf and its mutations to exports will be preserved in moduleCache
    for (const specifier of noDependencies) {
      await import(resolve(specifier));
    }
    log("Leaves executed", noDependencies, moduleCache);
    const executed = new Set();
    // continue finding next modules to execute by taking first that has its dependencies met in moduleCache
    let next = findNext(graph, executed);
    while (next) {
      log("Executing", next[0]);
      await import(resolve(next[0]));
      executed.add(next[0]);
      next = findNext(graph, executed);
    }

    log("Graph executed", graph, moduleCache);
  };

  const importCJS = async (specifier) => {
    const { graph, noDependencies } = await createGraph(specifier);

    await bottomUpExecute({ graph, noDependencies });

    return REQUIRE(specifier);
  };

  globalThis.importCJS = importCJS;
})();
