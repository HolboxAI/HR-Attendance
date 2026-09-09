from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import datetime
import uuid

from app.main import app
from app.core.database import Base, get_db
from app.models.employee import Employee, User
from app.models.correction import CorrectionRequest
from app.core.security import create_access_token

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

def setup_data():
    db = TestingSessionLocal()
    # Create test employee
    emp1 = Employee(emp_code="TEST01", full_name="Test Employee", email="test@example.com", department="IT", designation="Dev", manager_code=None, date_of_joining=datetime.date.today(), correction_limit=5)
    db.add(emp1)
    
    # Create user for employee
    user1 = User(id=uuid.uuid4(), email="test@example.com", hashed_password="hashed", role="employee", employee_code="TEST01", can_punch=True)
    db.add(user1)

    # Create test admin
    admin = Employee(emp_code="ADMIN01", full_name="Test Admin", email="admin@example.com", department="HR", designation="HR", manager_code=None, date_of_joining=datetime.date.today())
    db.add(admin)
    user_admin = User(id=uuid.uuid4(), email="admin@example.com", hashed_password="hashed", role="hr", employee_code="ADMIN01", can_punch=False)
    db.add(user_admin)
    
    db.commit()
    return user1, user_admin

def run_tests():
    db = TestingSessionLocal()
    # Clean DB
    db.query(CorrectionRequest).delete()
    db.query(User).delete()
    db.query(Employee).delete()
    db.commit()

    user_emp, user_admin = setup_data()
    
    emp_token = create_access_token(data={"sub": str(user_emp.id)})
    admin_token = create_access_token(data={"sub": str(user_admin.id)})
    
    emp_headers = {"Authorization": f"Bearer {emp_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    
    # Test 1: Submit a correction
    print("Test 1: Submit Correction")
    res = client.post("/api/v1/corrections", json={
        "shift_date": "2026-08-20",
        "direction": "in",
        "claimed_at": "2026-08-20T09:00:00+05:30",
        "reason": "forgot",
        "category": "Forgot to punch"
    }, headers=emp_headers)
    assert res.status_code == 200, res.text
    print("✅ Submit Correction Passed")

    # Test 2: Verify summary endpoint
    print("Test 2: Admin Correction Summary")
    res = client.get("/api/v1/admin/corrections/summary", headers=admin_headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data) == 1
    assert data[0]["employee_code"] == "TEST01"
    assert data[0]["used_corrections"] == 1
    assert data[0]["correction_limit"] == 5
    print("✅ Admin Correction Summary Passed")

    # Test 3: Update correction limit
    print("Test 3: Update Correction Limit")
    res = client.patch("/api/v1/admin/employees/TEST01", json={"correction_limit": 10}, headers=admin_headers)
    assert res.status_code == 200, res.text
    assert res.json()["correction_limit"] == 10
    print("✅ Update Correction Limit Passed")

    # Test 4: Verify limit is updated in summary
    print("Test 4: Verify updated limit in summary")
    res = client.get("/api/v1/admin/corrections/summary", headers=admin_headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data[0]["correction_limit"] == 10
    print("✅ Verify updated limit in summary Passed")

if __name__ == "__main__":
    run_tests()
