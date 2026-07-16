const path = require("path");
require("dotenv").config();

const {
  User,
  Employee,
  Customer,
  Session,
  Message,
  Ticket,
  ServiceCategory,
  QA,
} = require("../src/models");

async function checkDatabase() {
  try {
    const userCount = await User.count();
    const employeeCount = await Employee.count();
    const customerCount = await Customer.count();
    const sessionCount = await Session.count();
    const messageCount = await Message.count();
    const ticketCount = await Ticket.count();
    const serviceCategoryCount = await ServiceCategory.count();
    const qaCount = await QA.count();

    console.log("=== Database Diagnostic Summary ===");
    console.log(`Users: ${userCount}`);
    console.log(`Employees: ${employeeCount}`);
    console.log(`Customers: ${customerCount}`);
    console.log(`Sessions (Conversations): ${sessionCount}`);
    console.log(`Messages: ${messageCount}`);
    console.log(`Tickets: ${ticketCount}`);
    console.log(`Service Categories: ${serviceCategoryCount}`);
    console.log(`QAs (Knowledge Base): ${qaCount}`);

    console.log("\n=== Service Categories ===");
    const categories = await ServiceCategory.findAll();
    for (const cat of categories) {
      console.log(
        `- ID: ${cat.service_id}, Name: ${cat.service_name}, Status: ${cat.status}`,
      );
    }

    console.log("\n=== QAs ===");
    const qas = await QA.findAll({
      include: [{ model: ServiceCategory, as: "serviceCategory" }],
    });
    for (const qa of qas) {
      console.log(
        `- ID: ${qa.id}, Category: ${qa.serviceCategory?.service_name}, Content Length: ${qa.content.length}`,
      );
      console.log(`  Content Preview: ${qa.content.slice(0, 150)}...\n`);
    }

    console.log("\n=== Sample Customers ===");
    const customers = await Customer.findAll({
      limit: 10,
      include: [{ model: User, as: "user" }],
    });
    for (const c of customers) {
      console.log(
        `- Member ID: ${c.member_id}, Phone: ${c.phone}, Name: ${c.user?.name || "N/A"}, Role: ${c.role}`,
      );
    }

    process.exit(0);
  } catch (err) {
    console.error("Diagnostic error:", err);
    process.exit(1);
  }
}

checkDatabase();
