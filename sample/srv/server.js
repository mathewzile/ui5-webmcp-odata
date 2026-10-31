import cds from "@sap/cds";

cds.on("bootstrap", (app) => {
  app.use((req, res, next) => {
    res.setHeader("Origin-Agent-Cluster", "?1");
    res.set("Origin-Agent-Cluster", "?1");
    next();
  });
});
