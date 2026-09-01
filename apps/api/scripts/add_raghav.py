import uuid
import os
import sys

# Add the project root to sys.path so we can import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.session import SessionLocal
from app.models.employee import Employee, User
from app.models.org import Organization
from app.models.enums import UserRole

def main():
    db = SessionLocal()
    org = db.query(Organization).first()
    if not org:
        print("No organization found.")
        return

    # Check if Raghav already exists
    emp = db.query(Employee).filter(Employee.full_name == "Raghav Sharma").first()
    if not emp:
        emp = Employee(
            id=uuid.uuid4(),
            org_id=org.id,
            emp_code="EMP-RAGHAV",
            full_name="Raghav Sharma",
            is_active=True
        )
        db.add(emp)
        db.flush()

    user = db.query(User).filter(User.email == "krishraghavsharma@gmail.com").first()
    if not user:
        user = User(
            id=uuid.uuid4(),
            org_id=org.id,
            employee_id=emp.id,
            email="krishraghavsharma@gmail.com",
            role=UserRole.HR_ADMIN,
            is_active=True
        )
        # Fake password hash
        user.password_hash = "fake_hash"
        db.add(user)
    else:
        user.role = UserRole.HR_ADMIN
        user.employee_id = emp.id

    db.commit()
    print("Raghav added as HR_ADMIN")

if __name__ == "__main__":
    main()
