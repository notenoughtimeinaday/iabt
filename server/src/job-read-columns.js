// Workspace polling must not transfer saved model responses, tool arguments,
// uploaded source, or base64 artifacts from Postgres just to discard them in
// publicJob(). Workers and recovery continue to read complete durable jobs.
export const JOB_SUMMARY_COLUMNS = `id, owner_id, job_type, status, credit_amount,
  last_error_code, last_error_message, available_at, created_at, updated_at, completed_at,
  jsonb_build_object(
    'plan_id', input->'plan_id', 'conversation_id', input->'conversation_id',
    'project_id', input->'project_id', 'intent', input->'intent',
    'render_ready', input->'render_ready', 'provider_job_id', input->'provider_job_id'
  ) AS input,
  jsonb_build_object('pricing_version', approval->'pricing_version') AS approval,
  jsonb_build_object(
    'plan_id', output->'plan_id', 'conversation_id', output->'conversation_id',
    'project_id', output->'project_id', 'intent', output->'intent',
    'artifact_id', output->'artifact_id', 'artifact_manifest', output->'artifact_manifest',
    'provider_metadata', output->'provider_metadata',
    'credit_settlement', output->'credit_settlement',
    'incident_id', output->'incident_id', 'recovery', output->'recovery',
    'released_credits', output->'released_credits', 'provider_state', output->'provider_state',
    'orchestration', CASE WHEN jsonb_typeof(output->'orchestration') = 'object' THEN
      jsonb_build_object(
        'phase', output->'orchestration'->'phase', 'turn', output->'orchestration'->'turn',
        'inspected_file_ids', output->'orchestration'->'inspected_file_ids',
        'failures', output->'orchestration'->'failures',
        'execution_graph', jsonb_build_object('nodes', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', node->'id', 'tool', node->'tool',
            'depends_on', node->'depends_on', 'status', node->'status'
          )), '[]'::jsonb)
          FROM jsonb_array_elements(CASE
            WHEN jsonb_typeof(output->'orchestration'->'execution_graph'->'nodes') = 'array'
            THEN output->'orchestration'->'execution_graph'->'nodes' ELSE '[]'::jsonb END) node
        ))
      ) ELSE NULL END
  ) AS output`;
