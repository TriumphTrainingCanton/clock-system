const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

const ADMIN_PIN = "9274";

function unlockAdmin() {
  const pin = document.getElementById("adminPin").value.trim();
  const status = document.getElementById("status");
  const dashboard = document.getElementById("dashboard");

  if (pin !== ADMIN_PIN) {
    status.className = "error";
    status.innerText = "Error: Incorrect Admin PIN.";
    dashboard.style.display = "none";
    return;
  }

  status.className = "success";
  status.innerText = "Admin Dashboard Unlocked.";
  dashboard.style.display = "block";

  loadClockedInEmployees();
}

function loadClockedInEmployees() {
  fetch(url, {
    method: "POST",
    body: JSON.stringify({
      action: "Get Clocked In"
    })
  })
  .then(res => res.text())
  .then(data => {
    const container = document.getElementById("clockedInList");

    let employees = [];

    try {
      employees = JSON.parse(data);
    } catch {
      container.innerHTML = "Error loading employees.";
      return;
    }

    if (employees.length === 0) {
      container.innerHTML = "No employees currently clocked in.";
      return;
    }

    container.innerHTML = employees
      .map(name => `${name}`)
      .join("<br>");
  })
  .catch(() => {
    document.getElementById("clockedInList").innerHTML =
      "Connection error.";
  });
}