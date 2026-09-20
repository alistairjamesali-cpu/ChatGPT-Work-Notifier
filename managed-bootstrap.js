(() => {
  "use strict";
  try {
    const url = new URL(location.href);
    const token = url.searchParams.get("cwn_managed");
    if (token && /^[a-f0-9]{32}$/i.test(token)) {
      sessionStorage.setItem("cwn_managed_token", token);
      url.searchParams.delete("cwn_managed");
      const clean = `${url.pathname}${url.search}${url.hash}` || "/";
      history.replaceState(history.state, "", clean);
    }
  } catch (_) {}
})();
