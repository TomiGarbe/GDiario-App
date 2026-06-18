function autorizarTodo() {
  const result = {
    temp_spreadsheet_id: "",
    temp_spreadsheet_name: "",
    drive_file_id: "",
    active_user_email: "",
    trigger_count: 0,
    fetch_status: ""
  };

  const tempSpreadsheet = SpreadsheetApp.create("gdiario-auth-bootstrap");
  result.temp_spreadsheet_id = tempSpreadsheet.getId();
  result.temp_spreadsheet_name = tempSpreadsheet.getName();

  const driveFile = DriveApp.getFileById(result.temp_spreadsheet_id);
  result.drive_file_id = driveFile.getId();

  result.active_user_email = Session.getActiveUser().getEmail() || "";
  result.trigger_count = ScriptApp.getProjectTriggers().length;

  const response = UrlFetchApp.fetch("https://gdiario.azurewebsites.net/", {
    method: "get",
    muteHttpExceptions: true
  });
  result.fetch_status = String(response.getResponseCode());

  driveFile.setTrashed(true);

  Logger.log("AUTORIZAR TODO: " + JSON.stringify(result));
  return result;
}
