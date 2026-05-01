function eliminarTriggersProceso(){
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(t=>{
    if(t.getHandlerFunction()=="procesoDetalle3Meses"){
      ScriptApp.deleteTrigger(t);
    }
  });
}