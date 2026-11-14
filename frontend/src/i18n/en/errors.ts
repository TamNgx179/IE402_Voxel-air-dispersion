/** User-facing error copy. Raw server text is never shown; see api/client.ts. */
const errors = {
  'api.timeout': 'The connection timed out. You can try again.',
  'api.network': 'Cannot reach the API. Check that the application and network are running.',
  'api.invalid': 'The API returned invalid data. Check that the right application and port are running.',
  'api.notFound': 'Data not found. Please select the result again.',
  'api.conflict': 'The data is not ready or not compatible. Please select the result again.',
  'api.permission': 'You do not have permission to access this data.',
  'api.server': 'The application could not process the request. Please try again later.',
  'api.validation': 'The input is not valid. Check your selection.',
  unknown: 'Something went wrong. Please try again.',
  noStudyArea: 'The database has no study area yet; run db:seed.',
  runNotFound: 'Result {id} was not found.',
  windMismatch: 'The wind field does not match the result.',
  mapUnavailable: 'The map could not be started in this browser (WebGL is required).',
} as const;
export default errors;
