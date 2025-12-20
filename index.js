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
  const { create, defineProperty, defineProperties } = Object;
  const { log } = console;

  // the goal here is to delay getting an error as long as possible
  const politeProxy = () =>
    new Proxy(function () {}, {
      has: () => true,
      get: () => politeProxy(),
    });

  const resolve = (specifier) => {
    // FIXME: I don't want to do this right now for a PoC
    // leaving this as an exercise for the reader
    return specifier + ".cjs";
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

  globalThis.createGraph = createGraph;
})();

(function () {
  const modules = create(null);

  const whosthere = (stack) => {
    // figure out module name from stack
  };

  const MODULE = {};
  defineProperty(globalThis, "module", {
    value: MODULE,
    configurable: false,
    enumerable: false,
  });
  defineProperty(MODULE, "exports", {
    get() {},
    set(v) {},
  });

  defineProperty(globalThis, "exports", {
    get() {
      return MODULE.exports;
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  const REQUIRE = (specifier) => {};

  defineProperty(globalThis, "require", {
    value: REQUIRE,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  const importCJS = async (specifier) => {
    //initial setup - move here?

    REQUIRE(specifier);
  };
});
