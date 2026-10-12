-- Managers linked to an employee read and write scorecards only for their
-- reporting tree, matching what the app shows them. Before this, the
-- department/location check let them read (and write) any scorecard in their
-- departments/locations — or every scorecard when none were set — through the
-- API, even though the app hid those rows.
--
-- Unlinked managers keep the department/location scope plus anyone they
-- manage. Admins and users are unchanged.

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
      and (
        cardinality(private.scorecards_current_departments()) = 0
        or scorecard_department = any (private.scorecards_current_departments())
      )
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

-- A scorecard sent to a manager for review stays readable and approvable by
-- them even if the employee is outside their reporting tree (e.g. it was
-- submitted by an unlinked manager working from department scope).
drop policy if exists "Reviewers read assigned scorecards" on public.scorecards;
create policy "Reviewers read assigned scorecards"
  on public.scorecards
  for select
  to authenticated
  using (
    private.scorecards_current_role() = 'manager'
    and reviewer_id::text = auth.uid()::text
  );

drop policy if exists "Reviewers update assigned scorecards" on public.scorecards;
create policy "Reviewers update assigned scorecards"
  on public.scorecards
  for update
  to authenticated
  using (
    private.scorecards_current_role() = 'manager'
    and reviewer_id::text = auth.uid()::text
  )
  with check (
    private.scorecards_current_role() = 'manager'
    and reviewer_id::text = auth.uid()::text
  );
