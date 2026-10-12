-- A manager not linked to an employee and with no departments isn't set up yet, so the
-- department/location scope grants them nothing (it used to mean "every department").
-- They still see anyone explicitly assigned to them. Matches scopedScorecardsForProfile.

-- Same signature (keeps the OID the scorecards policies are bound to).
create or replace function private.scorecards_can_read_scorecard(
  scorecard_employee_name text,
  scorecard_location text,
  scorecard_department text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when private.scorecards_current_role() = 'admin' then true
    when private.scorecards_current_role() = 'manager'
      and private.scorecards_manages_employee(scorecard_employee_name)
      then true
    -- The department/location scope only applies to managers not linked to an employee.
    when private.scorecards_current_role() = 'manager'
      and private.scorecards_current_linked_employee() = ''
      and scorecard_department = any (private.scorecards_current_departments())
      and (
        cardinality(private.scorecards_current_locations()) = 0
        or scorecard_location = any (private.scorecards_current_locations())
      )
      then true
    when private.scorecards_current_role() = 'user'
      and scorecard_employee_name = private.scorecards_current_linked_employee()
      then true
    else false
  end;
$$;
