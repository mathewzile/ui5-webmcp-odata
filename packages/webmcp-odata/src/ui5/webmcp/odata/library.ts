import ObjectPath from "sap/base/util/ObjectPath";
import Library from "sap/ui/core/Lib";

/**
 * Library that derives WebMCP tools from OData V4 metadata.
 *
 * @namespace ui5.webmcp.odata
 */
const thisLib = Library.init({
  apiVersion: 2,
  name: "ui5.webmcp.odata",
  version: "${version}",
  dependencies: ["sap.ui.core", "sap.m"],
  types: [],
  interfaces: [],
  controls: [],
  elements: [],
  noLibraryCSS: true,
});

ObjectPath.set("ui5.webmcp.odata", thisLib);

export default thisLib;
