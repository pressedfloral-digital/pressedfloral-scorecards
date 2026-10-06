-- Assign team members to managers from the Rippling upload, and let managers
-- read/write scorecards (and individual-goal data) for everyone assigned to them.
--
-- Each uploaded row can carry an explicit assigned_manager_id (the manager
-- profile matched or confirmed during the upload). A manager "manages" an
-- employee when the employee is reachable from them through any of:
--   * the Rippling Manager name chain (rippling_employees.manager), starting
--     at the manager's linked employee name,
--   * an assigned_manager_id pointing at the manager, or
--   * either of the above for any user below them in the supervisor_id chain.
-- This replaces the department/location-only check that blocked managers
-- from saving scorecards for reports outside their department/location scope.

alter table public.rippling_employees
  add column if not exists assigned_manager_id uuid
  references public.manager_profiles(id) on delete set null;

create index if not exists rippling_employees_assigned_manager_idx
  on public.rippling_employees (assigned_manager_id);
create index if not exists rippling_employees_manager_idx
  on public.rippling_employees (manager);

create or replace function private.scorecards_manages_employee(target_employee_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  -- One edge list over two kinds of node: employee names, and "profile:<id>"
  -- for app users. When the uploader picks a manager for a row, the app also
  -- rewrites that row's manager name to the picked user's linked employee
  -- name, so the two Rippling edges below always agree.
  with recursive edges as (
    select re.manager as parent_node, re.full_name as child_node
    from public.rippling_employees re
    where re.manager is not null and re.manager <> ''
    union all
    select 'profile:' || re.assigned_manager_id::text, re.full_name
    from public.rippling_employees re
    where re.assigned_manager_id is not null
    union all
    -- An app user linked to an employee sits at that employee's spot in the tree.
    select p.linked_employee_name, 'profile:' || p.id::text
    from public.manager_profiles p
    where p.linked_employee_name is not null and p.linked_employee_name <> ''
    union all
    -- Supervisor chain on the Users page.
    select 'profile:' || p.supervisor_id::text, 'profile:' || p.id::text
    from public.manager_profiles p
    where p.supervisor_id is not null
  ),
  reach as (
    select 'profile:' || id::text as node
    from public.manager_profiles
    where id = auth.uid()
    union
    select linked_employee_name
    from public.manager_profiles
    where id = auth.uid() and linked_employee_name is not null and linked_employee_name <> ''
    union
    select e.child_node
    from edges e
    join reach r on e.parent_node = r.node
  )
  select coalesce(target_employee_name, '') <> ''
    and exists (select 1 from reach where node = target_employee_name);
$$;

revoke execute on function private.scorecards_manages_employee(text) from public, anon;
grant execute on function private.scorecards_manages_employee(text) to authenticated;

-- Same signature (keeps the OID the scorecards policies are bound to). Also
-- repoints the helper calls at private.* — the originals moved schemas in
-- 20260521134843.
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
      and (
        private.scorecards_manages_employee(scorecard_employee_name)
        or (
          (
            cardinality(private.scorecards_current_departments()) = 0
            or scorecard_department = any (private.scorecards_current_departments())
          )
          and (
            cardinality(private.scorecards_current_locations()) = 0
            or scorecard_location = any (private.scorecards_current_locations())
          )
        )
      )
      then true
    when private.scorecards_current_role() = 'user'
      and scorecard_employee_name = private.scorecards_current_linked_employee()
      then true
    else false
  end;
$$;

-- Individual-goal actuals/targets for a specific employee are keyed
-- "<goal name>::<employee name>". Let a manager write them for anyone they
-- manage, even outside their department/location scope.
create or replace function private.scorecards_can_manage_actual(
  actual_goal_tier text,
  actual_location text,
  actual_department text,
  actual_goal_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when actual_goal_tier = '__meta__' then
      private.scorecards_can_manage_scope(
        private.scorecards_meta_part(actual_goal_name, 1),
        private.scorecards_meta_part(actual_goal_name, 2),
        private.scorecards_meta_part(actual_goal_name, 3)
      )
      or (
        private.scorecards_current_role() = 'manager'
        and private.scorecards_meta_part(actual_goal_name, 1) = 'individual'
        and position('::' in coalesce(private.scorecards_meta_part(actual_goal_name, 4), '')) > 0
        and private.scorecards_manages_employee(split_part(private.scorecards_meta_part(actual_goal_name, 4), '::', 2))
      )
    else
      private.scorecards_can_manage_scope(actual_goal_tier, actual_location, actual_department)
      or (
        private.scorecards_current_role() = 'manager'
        and actual_goal_tier = 'individual'
        and position('::' in coalesce(actual_goal_name, '')) > 0
        and private.scorecards_manages_employee(split_part(actual_goal_name, '::', 2))
      )
  end;
$$;

-- Individual goals assigned to a specific employee: allow their manager to
-- create/edit/delete them regardless of department/location scope.
drop policy if exists "Managers manage individual goals for their reports" on public.goals_bank;
create policy "Managers manage individual goals for their reports"
  on public.goals_bank
  for all
  to authenticated
  using (
    private.scorecards_current_role() = 'manager'
    and goal_tier = 'individual'
    and private.scorecards_manages_employee(employee_name)
  )
  with check (
    private.scorecards_current_role() = 'manager'
    and goal_tier = 'individual'
    and private.scorecards_manages_employee(employee_name)
  );

-- The upload rewrites a month's rows (delete + insert), and admins resolve
-- manager mismatches in that same upload — no separate update grant needed.
