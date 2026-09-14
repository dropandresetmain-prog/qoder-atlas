-- M8 (0105): closed vocabulary of authority action kinds for consequential work.

INSERT INTO authority_action_kinds (action_kind, installed_by) VALUES
  ('action.intent.authorize', 'M8'),
  ('action.intent.dispatch', 'M8'),
  ('action.budget.commit', 'M8'),
  ('action.execution.observe', 'M8'),
  ('action.execution.reconcile', 'M8'),
  ('programme.item.schedule.write', 'M8')
ON CONFLICT (action_kind) DO NOTHING;
