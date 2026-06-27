const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');

initializeApp();

exports.onReportCreated = onDocumentCreated('reports/{reportId}', (event) => {
  const reportId = event.params.reportId;
  const authId = event.authId ?? null;
  console.log(`Report created: ${reportId}, uid: ${authId}`);
});

exports.onReportUpdated = onDocumentUpdated('reports/{reportId}', (event) => {
  const reportId = event.params.reportId;
  const authId = event.authId ?? null;
  console.log(`Report updated: ${reportId}, uid: ${authId}`);
});
