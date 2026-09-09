import uuid
from datetime import date, time, timedelta
from app.db.session import SessionLocal
from app.models.attendance import (
    ShiftTemplate,
    ShiftAssignment,
    ShiftGroup,
    ShiftGroupMember,
)
from app.models.employee import Employee, User
from app.models.org import Organization
from app.models.leave import LeaveRequest, LeaveType
from app.models.enums import UserRole
from app.services.attendance import resolve_shift, policy_for
from app.api.routes.leave import LEAVE_REASON_CATEGORIES

def run_tests():
    db = SessionLocal()
    try:
        org = db.scalar(select_org := None or Organization.__table__.select())
        org_row = db.query(Organization).first()
        assert org_row is not None, "Organization not found"
        org_id = org_row.id
        print(f"Testing with Org: {org_row.name} ({org_id})")

        employees = db.query(Employee).filter(Employee.org_id == org_id, Employee.is_active == True).limit(5).all()
        assert len(employees) >= 2, "Need at least 2 active employees"
        emp1 = employees[0]
        emp2 = employees[1]
        today = date.today()

        print(f"Emp 1: {emp1.full_name} ({emp1.emp_code})")
        print(f"Emp 2: {emp2.full_name} ({emp2.emp_code})")

        # -------------------------------------------------------------------
        # Test 1: Leave Categories
        # -------------------------------------------------------------------
        print("\n--- Test 1: Leave Categories ---")
        assert "Personal" in LEAVE_REASON_CATEGORIES
        assert "Family emergency" in LEAVE_REASON_CATEGORIES
        assert "Medical/health-related" in LEAVE_REASON_CATEGORIES
        assert "Family/household responsibility" in LEAVE_REASON_CATEGORIES
        assert "Other legitimate personal reason" in LEAVE_REASON_CATEGORIES
        print("✓ All 5 PRD leave reason categories verified.")

        # -------------------------------------------------------------------
        # Test 2: Create Shift Templates
        # -------------------------------------------------------------------
        print("\n--- Test 2: Shift Templates ---")
        # Clean up any previous test templates
        db.query(ShiftAssignment).filter(ShiftAssignment.employee_id.in_([emp1.id, emp2.id])).delete()
        db.query(ShiftGroupMember).filter(ShiftGroupMember.employee_id.in_([emp1.id, emp2.id])).delete()
        db.commit()

        # Shift A: Org Default (Morning 09:00 - 18:00)
        t_default = ShiftTemplate(
            org_id=org_id,
            name="Test Default Shift",
            start_time=time(9, 0),
            end_time=time(18, 0),
            break_minutes=60,
            grace_minutes=15,
        )
        db.add(t_default)

        # Shift B: Group Shift (Evening 14:00 - 23:00)
        t_group = ShiftTemplate(
            org_id=org_id,
            name="Test Group Shift",
            start_time=time(14, 0),
            end_time=time(23, 0),
            break_minutes=45,
            grace_minutes=10,
        )
        db.add(t_group)

        # Shift C: Direct Override (Night 22:00 - 06:00)
        t_direct = ShiftTemplate(
            org_id=org_id,
            name="Test Direct Override Shift",
            start_time=time(22, 0),
            end_time=time(6, 0),
            break_minutes=30,
            grace_minutes=10,
        )
        db.add(t_direct)
        db.commit()

        # Set t_default as organization default
        org_row.settings = {**org_row.settings, "default_shift_template_id": str(t_default.id)}
        db.commit()
        print(f"✓ Created templates and set org default: {t_default.name}")

        # -------------------------------------------------------------------
        # Test 3: Hierarchy Step 1 - Org Default
        # -------------------------------------------------------------------
        print("\n--- Test 3: Org Default Resolution ---")
        tpl, source, group_name, assign_id = resolve_shift(db, emp1, today)
        assert tpl is not None and tpl.id == t_default.id, f"Expected default template, got {tpl}"
        assert source == "default", f"Expected source 'default', got {source}"
        print(f"✓ Emp1 resolves to Org Default: {tpl.name} (source: {source})")

        # -------------------------------------------------------------------
        # Test 4: Hierarchy Step 2 - Group Shift Override
        # -------------------------------------------------------------------
        print("\n--- Test 4: Group Shift Resolution ---")
        group = ShiftGroup(
            org_id=org_id,
            name="Test Engineering Squad",
            shift_template_id=t_group.id,
        )
        db.add(group)
        db.flush()

        member = ShiftGroupMember(shift_group_id=group.id, employee_id=emp1.id)
        db.add(member)
        db.commit()

        tpl, source, group_name, assign_id = resolve_shift(db, emp1, today)
        assert tpl is not None and tpl.id == t_group.id, f"Expected group template, got {tpl}"
        assert source == "group", f"Expected source 'group', got {source}"
        assert group_name == "Test Engineering Squad"
        print(f"✓ Emp1 resolves to Group Shift: {tpl.name} (source: {source}, group: {group_name})")

        # Emp2 is not in the group, so Emp2 should still get Org Default
        tpl2, source2, _, _ = resolve_shift(db, emp2, today)
        assert tpl2.id == t_default.id and source2 == "default"
        print(f"✓ Emp2 still gets Org Default: {tpl2.name} (source: {source2})")

        # -------------------------------------------------------------------
        # Test 5: Hierarchy Step 3 - Direct Assignment Override
        # -------------------------------------------------------------------
        print("\n--- Test 5: Direct Shift Override Resolution ---")
        direct_assignment = ShiftAssignment(
            employee_id=emp1.id,
            shift_template_id=t_direct.id,
            effective_from=today - timedelta(days=1),
        )
        db.add(direct_assignment)
        db.commit()

        tpl, source, group_name, assign_id = resolve_shift(db, emp1, today)
        assert tpl is not None and tpl.id == t_direct.id, f"Expected direct template, got {tpl}"
        assert source == "direct", f"Expected source 'direct', got {source}"
        assert assign_id == direct_assignment.id
        print(f"✓ Emp1 resolves to Direct Assignment: {tpl.name} (source: {source}) - successfully overrides group!")

        # -------------------------------------------------------------------
        # Test 6: Policy computation reflects direct shift
        # -------------------------------------------------------------------
        print("\n--- Test 6: policy_for calculation ---")
        policy, policy_tpl_id = policy_for(db, emp1, today)
        assert policy.start_time == time(22, 0)
        assert policy.end_time == time(6, 0)
        assert policy_tpl_id == t_direct.id
        print(f"✓ policy_for reflects direct shift {policy.start_time} - {policy.end_time}")

        # -------------------------------------------------------------------
        # Test 7: Remove Direct Assignment -> falls back immediately to Group
        # -------------------------------------------------------------------
        print("\n--- Test 7: Fallback to Group upon Direct Assignment Removal ---")
        db.delete(direct_assignment)
        db.commit()

        tpl, source, group_name, _ = resolve_shift(db, emp1, today)
        assert tpl.id == t_group.id and source == "group"
        print(f"✓ Emp1 immediately falls back to Group Shift: {tpl.name}")

        # -------------------------------------------------------------------
        # Test 8: Remove from Group -> falls back immediately to Org Default
        # -------------------------------------------------------------------
        print("\n--- Test 8: Fallback to Org Default upon Group Removal ---")
        db.delete(member)
        db.commit()

        tpl, source, _, _ = resolve_shift(db, emp1, today)
        assert tpl.id == t_default.id and source == "default"
        print(f"✓ Emp1 immediately falls back to Org Default: {tpl.name}")

        # -------------------------------------------------------------------
        # Cleanup
        # -------------------------------------------------------------------
        db.delete(group)
        db.delete(t_direct)
        db.delete(t_group)
        db.delete(t_default)
        db.commit()
        print("\n✓ Cleaned up test artifacts.")
        print("\n>>> ALL PHASE 5 TESTS PASSED SUCCESSFULLY! <<<")

    finally:
        db.close()

if __name__ == "__main__":
    run_tests()
