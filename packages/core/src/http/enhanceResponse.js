export function enhanceResponse(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };

  res.json = function (data) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
    return res;
  };

  res.send = function (data) {
    if (data === undefined) {
      res.end();
      return res;
    }
    res.end(typeof data === "string" ? data : JSON.stringify(data));
    return res;
  };

  return res;
}
